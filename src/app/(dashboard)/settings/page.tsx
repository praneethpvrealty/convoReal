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
} from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { WhatsAppConfig } from '@/components/settings/whatsapp-config';
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
] as const;
const FLAGGED_TAB_VALUES = ['members', 'teams', 'routing'] as const;
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
    (requestedTab === 'routing' && !routingEnabled)
      ? 'profile'
      : requestedTab;

  const onChange = (next: TabValue) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('tab', next);
    router.replace(`/settings?${params.toString()}`, { scroll: false });
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Settings</h1>
        <p className="text-sm text-slate-400 mt-1">
          Manage your profile, WhatsApp® integration, message templates, and
          tags.
        </p>
      </div>

      <Tabs value={tab} onValueChange={(v) => onChange(v as TabValue)}>
        <TabsList className="bg-slate-900 border border-slate-700">
          <TabsTrigger
            value="profile"
            className="data-active:bg-slate-800 data-active:text-primary text-slate-400"
          >
            <User className="size-4" />
            Profile
          </TabsTrigger>
          <TabsTrigger
            value="whatsapp"
            className="data-active:bg-slate-800 data-active:text-primary text-slate-400"
          >
            <Settings className="size-4" />
            WhatsApp Config
          </TabsTrigger>
          <TabsTrigger
            value="templates"
            className="data-active:bg-slate-800 data-active:text-primary text-slate-400"
          >
            <MessageSquare className="size-4" />
            Templates
          </TabsTrigger>
          <TabsTrigger
            value="tags"
            className="data-active:bg-slate-800 data-active:text-primary text-slate-400"
          >
            <Tag className="size-4" />
            Tags
          </TabsTrigger>
          <TabsTrigger
            value="appearance"
            className="data-active:bg-slate-800 data-active:text-primary text-slate-400"
          >
            <Palette className="size-4" />
            Appearance
          </TabsTrigger>
          <TabsTrigger
            value="showcase"
            className="data-active:bg-slate-800 data-active:text-primary text-slate-400"
          >
            <Globe className="size-4" />
            Public Showcase
          </TabsTrigger>
          <TabsTrigger
            value="ai"
            className="data-active:bg-slate-800 data-active:text-primary text-slate-400"
          >
            <Sparkles className="size-4" />
            AI Config
          </TabsTrigger>
          <TabsTrigger
            value="other"
            className="data-active:bg-slate-800 data-active:text-primary text-slate-400"
          >
            <Sliders className="size-4" />
            Other
          </TabsTrigger>
          <TabsTrigger
            value="billing"
            className="data-active:bg-slate-800 data-active:text-primary text-slate-400"
          >
            <CreditCard className="size-4" />
            Billing
          </TabsTrigger>
          {/* Members tab is feature-flagged. We render the trigger
              only when the flag is enabled, so users without the
              flag see the original 5-tab layout. */}
          {accountSharingEnabled && (
            <TabsTrigger
              value="members"
              className="data-active:bg-slate-800 data-active:text-primary text-slate-400"
            >
              <UsersRound className="size-4" />
              Members
            </TabsTrigger>
          )}
          {teamsEnabled && (
            <TabsTrigger
              value="teams"
              className="data-active:bg-slate-800 data-active:text-primary text-slate-400"
            >
              <Users className="size-4" />
              Teams
            </TabsTrigger>
          )}
          {routingEnabled && (
            <TabsTrigger
              value="routing"
              className="data-active:bg-slate-800 data-active:text-primary text-slate-400"
            >
              <Route className="size-4" />
              Routing Rules
            </TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="profile" className="space-y-6">
          <ProfileForm />
          <PasswordForm />
          <SessionsCard />
        </TabsContent>

        <TabsContent value="whatsapp">
          <WhatsAppConfig />
        </TabsContent>

        <TabsContent value="templates">
          <TemplateManager />
        </TabsContent>

        <TabsContent value="tags">
          <TagManager />
        </TabsContent>

        <TabsContent value="appearance">
          <AppearancePanel />
        </TabsContent>

        <TabsContent value="showcase">
          <ShowcaseSettingsPanel />
        </TabsContent>

        <TabsContent value="ai">
          <AiSettingsPanel />
        </TabsContent>

        <TabsContent value="other">
          <OtherSettingsPanel />
        </TabsContent>

        <TabsContent value="billing">
          <BillingTab />
        </TabsContent>

        {accountSharingEnabled && (
          <TabsContent value="members">
            <MembersTab />
          </TabsContent>
        )}

        {teamsEnabled && (
          <TabsContent value="teams">
            <TeamsTab />
          </TabsContent>
        )}

        {routingEnabled && (
          <TabsContent value="routing">
            <RoutingRulesTab />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
