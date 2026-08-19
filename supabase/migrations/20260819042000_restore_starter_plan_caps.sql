-- Restore the Starter limits advertised by PLAN_CONFIG while preserving the
-- subscription-extension columns added after the original caps migration.
-- Generated in the timestamped format used by `supabase migration new`.

create or replace view public.account_plan_limits as
select
  a.id as account_id,
  coalesce(s.plan, 'starter'::text) as plan,
  coalesce(s.status, 'active'::text) as status,
  s.billing_cycle,
  s.current_period_end,
  s.pending_plan,
  s.pending_plan_effective_at,
  case coalesce(s.plan, 'starter'::text)
    when 'starter'::text then 1
    when 'solo_pro'::text then 1
    when 'team'::text then 3
    when 'agency'::text then 10
    else 1
  end as max_users,
  case coalesce(s.plan, 'starter'::text)
    when 'starter'::text then 150
    when 'solo_pro'::text then 1500
    when 'team'::text then 4500
    when 'agency'::text then 15000
    else 150
  end as max_contacts,
  case coalesce(s.plan, 'starter'::text)
    when 'starter'::text then 50
    when 'solo_pro'::text then 500
    when 'team'::text then 1500
    when 'agency'::text then 5000
    else 50
  end as max_properties,
  case coalesce(s.plan, 'starter'::text)
    when 'starter'::text then 0
    when 'solo_pro'::text then 500
    when 'team'::text then 2000
    when 'agency'::text then 999999
    else 0
  end as max_broadcasts_per_month,
  coalesce(s.plan, 'starter'::text) <> 'starter'::text as has_ai,
  coalesce(s.plan, 'starter'::text) = any (array['team'::text, 'agency'::text]) as has_teams,
  coalesce(s.plan, 'starter'::text) = 'agency'::text as has_multi_number,
  coalesce(s.plan, 'starter'::text) = 'agency'::text as has_api_access,
  coalesce(s.plan, 'starter'::text) <> 'starter'::text as has_branded_showcase,
  coalesce(s.plan, 'starter'::text) = 'agency'::text as has_custom_subdomain,
  coalesce((
    select sum(e.days)::integer
    from public.subscription_extensions e
    where e.account_id = a.id
      and e.revoked_at is null
      and e.extended_until > now()
  ), 0) as extension_days,
  greatest(s.current_period_end, (
    select max(e.extended_until)
    from public.subscription_extensions e
    where e.account_id = a.id
      and e.revoked_at is null
      and e.extended_until > now()
  )) as effective_period_end
from public.accounts a
left join public.subscriptions s on s.account_id = a.id;
