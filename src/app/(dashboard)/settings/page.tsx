'use client';

import { useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { replaceUrl } from "@/lib/navigation";
import {
  Settings,
  MessageSquare,
  Tag,
  User,
  Palette,
  UsersRound,
  Globe,
  Sparkles,
  Sliders,
  CreditCard,
  Users,
  Route,
  Coins,
  Megaphone,
  Plug,
  Workflow,
  Newspaper,
} from 'lucide-react';
import { Tabs, TabsContent } from '@/components/ui/tabs';
import { WhatsAppConfig } from '@/components/settings/whatsapp-config';
import { WhatsAppFlowsCard } from '@/components/settings/whatsapp-flows-card';
import { OwnerDigestCard } from '@/components/settings/owner-digest-card';
import { MetaAdsTab } from '@/components/settings/meta-ads-tab';
import { TemplateManager } from '@/components/settings/template-manager';
import { TagManager } from '@/components/settings/tag-manager';
import { ProfileForm } from '@/components/settings/profile-form';
import { BusinessNameCard } from '@/components/settings/business-name-card';
import { PasswordForm } from '@/components/settings/password-form';
import { SessionsCard } from '@/components/settings/sessions-card';
import { AppearancePanel } from '@/components/settings/appearance-panel';
import { MembersTab } from '@/components/settings/members-tab';
import { TeamsTab } from '@/components/settings/teams-tab';
import { RoutingRulesTab } from '@/components/settings/routing-rules-tab';
import { ShowcaseSettingsPanel } from '@/components/settings/showcase-settings';
import { AiSettingsPanel } from '@/components/settings/ai-settings';
import { OtherSettingsPanel } from '@/components/settings/other-settings';
import { useAuth } from '@/hooks/use-auth';
import { usePlan } from '@/hooks/usePlan';
import { BillingTab } from '@/components/settings/billing-tab';
import { CreditsTab } from '@/components/settings/credits-tab';
import { cn } from '@/lib/utils';
import { InfoHint } from '@/components/ui/info-hint';
import { FavoriteButton } from "@/components/layout/favorite-button";

const BASE_TAB_VALUES = [
  'profile',
  'whatsapp',
  // 'templates' stays a valid URL value for old links/favorites, but
  // it now lives as a sub-tab under WhatsApp (see WHATSAPP_SUBTABS).
  'templates',
  'tags',
  'appearance',
  'showcase',
  'ai',
  'other',
  'billing',
  'credits',
] as const;
const FLAGGED_TAB_VALUES = ['members', 'teams', 'routing', 'ads'] as const;
const TAB_VALUES = [...BASE_TAB_VALUES, ...FLAGGED_TAB_VALUES] as const;
type TabValue = (typeof TAB_VALUES)[number];

function isTabValue(v: string | null): v is TabValue {
  return !!v && (TAB_VALUES as readonly string[]).includes(v);
}

// Everything WhatsApp-related lives under one tab, split into
// sub-tabs (?tab=whatsapp&sub=…): the connection/config page,
// message templates, WhatsApp Flows, and the owner digest.
const WHATSAPP_SUBTABS = [
  { value: 'connection', label: 'Connection', icon: Plug },
  { value: 'templates', label: 'Templates', icon: MessageSquare },
  { value: 'flows', label: 'Flows', icon: Workflow },
  { value: 'digest', label: 'Owner Digest', icon: Newspaper },
] as const;
type WhatsAppSub = (typeof WHATSAPP_SUBTABS)[number]['value'];

function isWhatsAppSub(v: string | null): v is WhatsAppSub {
  return !!v && WHATSAPP_SUBTABS.some((s) => s.value === v);
}

// Flag key matches what migration 011 introduced. The Members tab
// stays hidden until the user's profile.beta_features array contains
// this string; flip it via Supabase Studio:
//   UPDATE profiles SET beta_features = beta_features || ARRAY['account_sharing']
//   WHERE user_id = '<theirs>';
const ACCOUNT_SHARING_FLAG = 'account_sharing';

// Grouped sidebar items for compact navigation
interface NavGroup {
  label: string;
  items: { value: TabValue; label: string; icon: React.ComponentType<{ className?: string }> }[];
}

export default function SettingsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { profile, profileLoading, isOrgManager, isOrgLeader } = useAuth();
  const { isAllowed, isLoading: planLoading } = usePlan();

  const accountSharingEnabled =
    !profileLoading &&
    !!profile?.beta_features?.includes(ACCOUNT_SHARING_FLAG);

  // Teams/Routing Rules require both the plan flag (has_teams) and
  // Org Leader+ (Agents don't manage teams, so no point showing an
  // empty shell). Routing rules are further gated Manager-only inside
  // the tab itself, but the trigger is shown to Leaders too since
  // they can still view team structure via the Teams tab.
  const teamsEnabled = !planLoading && isAllowed('teams') && (isOrgManager || isOrgLeader);
  const routingEnabled = !planLoading && isAllowed('teams') && isOrgManager;

  // Kill switch for the whole Meta Ads feature while Meta app review is
  // pending (see docs/meta-ads-integration-plan.md §2) — the tab itself
  // handles the Starter-plan upsell, so this only gates whether the
  // feature exists on this deployment at all.
  const metaAdsEnabled = !!process.env.NEXT_PUBLIC_META_ADS_APP_ID;

  // The URL is the single source of truth for the active tab — no
  // local state, no sync effect. A previous revision duplicated this
  // into `useState` + a sync effect, which tripped React 19's
  // set-state-in-effect rule and was also redundant.
  const queryTab = searchParams.get('tab');
  const requestedTab: TabValue = isTabValue(queryTab) ? queryTab : 'profile';

  // If a user lands on a flagged tab that's currently disabled for
  // them (feature flag off, plan doesn't include it, or insufficient
  // role — e.g. a stale link or a downgraded plan), fall back to the
  // profile tab silently rather than rendering an empty TabsContent.
  // Legacy ?tab=templates links/favorites land on the WhatsApp tab
  // with the Templates sub-tab active.
  const tab: TabValue =
    requestedTab === 'templates'
      ? 'whatsapp'
      : (requestedTab === 'members' && !accountSharingEnabled) ||
          (requestedTab === 'teams' && !teamsEnabled) ||
          (requestedTab === 'routing' && !routingEnabled) ||
          (requestedTab === 'ads' && !metaAdsEnabled)
        ? 'profile'
        : requestedTab;

  const querySub = searchParams.get('sub');
  const whatsappSub: WhatsAppSub =
    requestedTab === 'templates'
      ? 'templates'
      : isWhatsAppSub(querySub)
        ? querySub
        : 'connection';

  const onChange = (next: TabValue) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('tab', next);
    params.delete('sub');
    replaceUrl(router, `/settings?${params.toString()}`);
  };

  const onSubChange = (next: WhatsAppSub) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('tab', 'whatsapp');
    params.set('sub', next);
    replaceUrl(router, `/settings?${params.toString()}`);
  };

  // The tab bars scroll horizontally on narrow screens — keep the
  // active pill in view, both on tap and when a deep link (e.g.
  // ?tab=showcase) lands with the active tab scrolled off-screen.
  // block:'nearest' so the page never jumps vertically.
  useEffect(() => {
    document
      .querySelector(`[data-tour="settings-tab-${tab}"]`)
      ?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'auto' });
  }, [tab]);
  useEffect(() => {
    if (tab !== 'whatsapp') return;
    const tour =
      whatsappSub === 'templates'
        ? 'settings-tab-templates'
        : `settings-tab-whatsapp-${whatsappSub}`;
    document
      .querySelector(`[data-tour="${tour}"]`)
      ?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'auto' });
  }, [tab, whatsappSub]);

  // Build navigation groups dynamically based on feature flags
  const navGroups: NavGroup[] = [
    {
      label: 'Account',
      items: [
        { value: 'profile', label: 'Profile', icon: User },
        { value: 'appearance', label: 'Appearance', icon: Palette },
      ],
    },
    {
      label: 'Messaging',
      items: [
        // Templates moved under WhatsApp as a sub-tab.
        { value: 'whatsapp', label: 'WhatsApp', icon: Settings },
        ...(metaAdsEnabled ? [{ value: 'ads' as TabValue, label: 'Ads', icon: Megaphone }] : []),
        { value: 'tags', label: 'Tags', icon: Tag },
      ],
    },
    {
      label: 'Billing',
      items: [
        { value: 'billing', label: 'Billing', icon: CreditCard },
        { value: 'credits', label: 'Credits', icon: Coins },
      ],
    },
    // "Public", "AI", and "Advanced" used to be three separate groups that
    // each rendered a full-width uppercase header over exactly one link
    // (Showcase / AI Config / Other) — three lines of label noise for
    // three lines of content. Combined into one group so every section
    // header earns its place with 2+ items; still grows cleanly as
    // Members/Teams/Routing flags turn on.
    {
      label: 'Workspace',
      items: [
        { value: 'showcase', label: 'Showcase', icon: Globe },
        { value: 'ai', label: 'AI Config', icon: Sparkles },
        { value: 'other', label: 'Other', icon: Sliders },
        ...(accountSharingEnabled ? [{ value: 'members' as TabValue, label: 'Members', icon: UsersRound }] : []),
        ...(teamsEnabled ? [{ value: 'teams' as TabValue, label: 'Teams', icon: Users }] : []),
        ...(routingEnabled ? [{ value: 'routing' as TabValue, label: 'Routing', icon: Route }] : []),
      ],
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center">
            Settings
            <InfoHint text="Configure your WhatsApp integration, message templates, team members, custom tags, and Showcase branding." />
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            Manage your profile, WhatsApp® integration, message templates, and tags.
          </p>
        </div>
        <FavoriteButton
          label={
            tab === 'whatsapp'
              ? `Settings: WhatsApp · ${WHATSAPP_SUBTABS.find((s) => s.value === whatsappSub)?.label}`
              : `Settings: ${tab.charAt(0).toUpperCase() + tab.slice(1)}`
          }
          href={tab === 'whatsapp' ? `/settings?tab=whatsapp&sub=${whatsappSub}` : `/settings?tab=${tab}`}
          icon="Settings"
        />
      </div>

      <Tabs value={tab} onValueChange={(v) => onChange(v as TabValue)} className="flex flex-col gap-5">
        {/* Horizontal Tab Navigation — group labels dropped in favor of a
            thin divider between clusters; a header line reads fine stacked
            above a column but wastes space and looks noisy repeated across
            a horizontal row.

            Single row that scrolls horizontally on narrow screens —
            wrapping produced ragged rows with orphaned group dividers
            at row starts. The scrollbar is hidden (the pill highlight
            + partial pill at the edge signal scrollability) and the
            active tab auto-scrolls into view on load via the effect
            below. */}
        <div
          data-settings-tabbar
          className="flex flex-nowrap items-center gap-1 border-b border-slate-800 pb-3 overflow-x-auto [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
        >
          {navGroups.map((group, groupIdx) => (
            <div key={group.label} className="flex items-center gap-1 shrink-0">
              {groupIdx > 0 && <div className="h-4 w-px bg-slate-800 mx-2 shrink-0" aria-hidden="true" />}
              {group.items.map(({ value, label, icon: Icon }) => (
                <button
                  key={value}
                  onClick={() => onChange(value)}
                  data-tour={`settings-tab-${value}`}
                  className={cn(
                    'flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md transition-colors whitespace-nowrap',
                    tab === value
                      ? 'bg-primary/10 text-primary font-medium'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
                  )}
                >
                  <Icon className="size-3.5 shrink-0" />
                  <span>{label}</span>
                </button>
              ))}
            </div>
          ))}
        </div>

        {/* Content Area — now spans the full page width */}
        <div className="w-full min-w-0">
          <TabsContent value="profile" className="space-y-6 mt-0">
            <ProfileForm />
            <BusinessNameCard />
            <PasswordForm />
            <SessionsCard />
          </TabsContent>

          <TabsContent value="whatsapp" className="mt-0 space-y-5" data-tour="whatsapp-config-form">
            {/* WhatsApp sub-navigation: connection, templates, flows,
                owner digest. Everything WhatsApp lives here instead of
                one endless scroll + a separate top-level Templates tab. */}
            <div
              data-settings-subtabbar
              className="flex w-fit max-w-full flex-nowrap items-center gap-1 rounded-lg border border-slate-800 bg-slate-900/60 p-1 overflow-x-auto [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
            >
              {WHATSAPP_SUBTABS.map(({ value, label, icon: Icon }) => (
                <button
                  key={value}
                  onClick={() => onSubChange(value)}
                  data-tour={`settings-tab-${value === 'templates' ? 'templates' : `whatsapp-${value}`}`}
                  className={cn(
                    'flex shrink-0 items-center gap-1.5 px-3 py-1.5 text-xs rounded-md transition-colors whitespace-nowrap',
                    whatsappSub === value
                      ? 'bg-primary/10 text-primary font-medium'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
                  )}
                >
                  <Icon className="size-3.5 shrink-0" />
                  <span>{label}</span>
                </button>
              ))}
            </div>

            {whatsappSub === 'connection' && <WhatsAppConfig />}
            {whatsappSub === 'templates' && <TemplateManager />}
            {whatsappSub === 'flows' && <WhatsAppFlowsCard />}
            {whatsappSub === 'digest' && <OwnerDigestCard />}
          </TabsContent>

          {metaAdsEnabled && (
            <TabsContent value="ads" className="mt-0">
              <MetaAdsTab />
            </TabsContent>
          )}

          <TabsContent value="tags" className="mt-0">
            <TagManager />
          </TabsContent>

          <TabsContent value="appearance" className="mt-0">
            <AppearancePanel />
          </TabsContent>

          <TabsContent value="showcase" className="mt-0">
            <ShowcaseSettingsPanel />
          </TabsContent>

          <TabsContent value="ai" className="mt-0">
            <AiSettingsPanel />
          </TabsContent>

          <TabsContent value="other" className="mt-0">
            <OtherSettingsPanel />
          </TabsContent>

          <TabsContent value="billing" className="mt-0">
            <BillingTab />
          </TabsContent>

          <TabsContent value="credits" className="mt-0">
            <CreditsTab />
          </TabsContent>

          {accountSharingEnabled && (
            <TabsContent value="members" className="mt-0">
              <MembersTab />
            </TabsContent>
          )}

          {teamsEnabled && (
            <TabsContent value="teams" className="mt-0">
              <TeamsTab />
            </TabsContent>
          )}

          {routingEnabled && (
            <TabsContent value="routing" className="mt-0">
              <RoutingRulesTab />
            </TabsContent>
          )}
        </div>
      </Tabs>
    </div>
  );
}
