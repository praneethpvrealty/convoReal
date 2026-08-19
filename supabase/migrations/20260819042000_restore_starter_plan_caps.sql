-- Restore the Starter limits advertised by PLAN_CONFIG and replace the
-- SECURITY DEFINER view with an RLS-aware, least-privilege design.
--
-- Raw subscription rows remain owner-only. Authenticated account members can
-- read only the calculated entitlement fields exposed by account_plan_limits.

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated, service_role;

create or replace function private.get_account_plan_limits(target_account_id uuid)
returns table (
  plan text,
  status text,
  billing_cycle text,
  current_period_end timestamptz,
  pending_plan text,
  pending_plan_effective_at timestamptz,
  max_users integer,
  max_contacts integer,
  max_properties integer,
  max_broadcasts_per_month integer,
  has_ai boolean,
  has_teams boolean,
  has_multi_number boolean,
  has_api_access boolean,
  has_branded_showcase boolean,
  has_custom_subdomain boolean,
  extension_days integer,
  effective_period_end timestamptz
)
language sql
stable
security definer
set search_path = ''
as $function$
  select
    coalesce(s.plan, 'starter'::text),
    coalesce(s.status, 'active'::text),
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
    end,
    case coalesce(s.plan, 'starter'::text)
      when 'starter'::text then 150
      when 'solo_pro'::text then 1500
      when 'team'::text then 4500
      when 'agency'::text then 15000
      else 150
    end,
    case coalesce(s.plan, 'starter'::text)
      when 'starter'::text then 50
      when 'solo_pro'::text then 500
      when 'team'::text then 1500
      when 'agency'::text then 5000
      else 50
    end,
    case coalesce(s.plan, 'starter'::text)
      when 'starter'::text then 0
      when 'solo_pro'::text then 500
      when 'team'::text then 2000
      when 'agency'::text then 999999
      else 0
    end,
    coalesce(s.plan, 'starter'::text) <> 'starter'::text,
    coalesce(s.plan, 'starter'::text) = any (array['team'::text, 'agency'::text]),
    coalesce(s.plan, 'starter'::text) = 'agency'::text,
    coalesce(s.plan, 'starter'::text) = 'agency'::text,
    coalesce(s.plan, 'starter'::text) <> 'starter'::text,
    coalesce(s.plan, 'starter'::text) = 'agency'::text,
    coalesce((
      select sum(e.days)::integer
      from public.subscription_extensions e
      where e.account_id = a.id
        and e.revoked_at is null
        and e.extended_until > now()
    ), 0),
    greatest(s.current_period_end, (
      select max(e.extended_until)
      from public.subscription_extensions e
      where e.account_id = a.id
        and e.revoked_at is null
        and e.extended_until > now()
    ))
  from public.accounts a
  left join public.subscriptions s on s.account_id = a.id
  where a.id = target_account_id
    and (
      coalesce(auth.jwt() ->> 'role', '') = 'service_role'
      or exists (
        select 1
        from public.profiles p
        where p.user_id = (select auth.uid())
          and p.account_id = a.id
      )
    );
$function$;

revoke all on function private.get_account_plan_limits(uuid) from public, anon, authenticated, service_role;
grant execute on function private.get_account_plan_limits(uuid) to authenticated, service_role;

create or replace view public.account_plan_limits
with (security_invoker = true)
as
select
  a.id as account_id,
  limits.*
from public.accounts a
cross join lateral private.get_account_plan_limits(a.id) limits;

revoke all on public.account_plan_limits from public, anon, authenticated, service_role;
grant select on public.account_plan_limits to authenticated, service_role;
