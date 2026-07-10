'use client';

import { useRouter, useSearchParams } from 'next/navigation';
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
} from 'lucide-react';
import { Tabs, TabsContent } from '@/components/ui/tabs';
import { WhatsAppConfig } from '@/components/settings/whatsapp-config';
import { MetaAdsTab } from '@/components/settings/meta-ads-tab';
import { TemplateManager } from '@/components/settings/template-manager';
import { TagManager } from '@/components/settings/tag-manager';
import { ProfileForm } from '@/components/settings/profile-form';
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

const BASE_TAB_VALUES = [
  'profile',
  'whatsapp',
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
  const tab: TabValue =
    (requestedTab === 'members' && !accountSharingEnabled) ||
    (requestedTab === 'teams' && !teamsEnabled) ||
    (requestedTab === 'routing' && !routingEnabled) ||
    (requestedTab === 'ads' && !metaAdsEnabled)
      ? 'profile'
      : requestedTab;

  const onChange = (next: TabValue) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('tab', next);
    router.replace(`/settings?${params.toString()}`, { scroll: false });
  };

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
        { value: 'whatsapp', label: 'WhatsApp', icon: Settings },
        ...(metaAdsEnabled ? [{ value: 'ads' as TabValue, label: 'Ads', icon: Megaphone }] : []),
        { value: 'templates', label: 'Templates', icon: MessageSquare },
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
      <div>
        <h1 className="text-2xl font-bold text-white flex items-center">
          Settings
          <InfoHint text="Configure your WhatsApp integration, message templates, team members, custom tags, and Showcase branding." />
        </h1>
        <p className="text-sm text-slate-400 mt-1">
          Manage your profile, WhatsApp® integration, message templates, and
          tags.
        </p>
      </div>

      <Tabs value={tab} onValueChange={(v) => onChange(v as TabValue)} className="flex flex-col gap-5">
        {/* Horizontal Tab Navigation — group labels dropped in favor of a
            thin divider between clusters; a header line reads fine stacked
            above a column but wastes space and looks noisy repeated across
            a horizontal row. */}
        <div className="flex flex-wrap items-center gap-1 border-b border-slate-800 pb-3">
          {navGroups.map((group, groupIdx) => (
            <div key={group.label} className="flex items-center gap-1">
              {groupIdx > 0 && <div className="h-4 w-px bg-slate-800 mx-2" aria-hidden="true" />}
              {group.items.map(({ value, label, icon: Icon }) => (
                <button
                  key={value}
                  onClick={() => onChange(value)}
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
            <PasswordForm />
            <SessionsCard />
          </TabsContent>

          <TabsContent value="whatsapp" className="mt-0">
            <WhatsAppConfig />
          </TabsContent>

          {metaAdsEnabled && (
            <TabsContent value="ads" className="mt-0">
              <MetaAdsTab />
            </TabsContent>
          )}

          <TabsContent value="templates" className="mt-0">
            <TemplateManager />
          </TabsContent>

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
