-- Applied to production on 14 Oct 2026 from a Claude session before this
-- file existed; recorded here so the repository matches the database.
--
-- 1. Queue of status-change notices for counterparts (never the property owner).
--    Rows are inserted as 'pending' by the triggers below; the app drains and sends them.
create table if not exists public.deal_status_notifications (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  contact_id uuid references public.contacts(id) on delete set null,
  recipient_name text,
  recipient_phone text,
  recipient_role text,
  property_id uuid references public.properties(id) on delete set null,
  deal_id uuid references public.deals(id) on delete set null,
  journey_item_id uuid references public.journey_items(id) on delete set null,
  event text not null check (event in ('dropped','lost','won','property_sold')),
  internal_reason text,
  message_text text not null,
  status text not null default 'pending' check (status in ('pending','sent','failed','skipped')),
  attempt_count int not null default 0,
  last_error text,
  message_id uuid,
  claimed_at timestamptz,
  sent_at timestamptz,
  created_at timestamptz not null default now()
);
comment on table public.deal_status_notifications is
  'Service-role queue of deal status-change notices for counterparts (buyer side; property owner excluded). Filled by triggers on journey_items, deals and properties; the app drains pending rows and sends via WhatsApp.';

create unique index if not exists deal_status_notifications_pending_dedupe
  on public.deal_status_notifications (account_id, contact_id, property_id, event)
  where status = 'pending';
create index if not exists deal_status_notifications_pending_idx
  on public.deal_status_notifications (account_id, created_at) where status = 'pending';

alter table public.deal_status_notifications enable row level security;
create policy "account members read own notices" on public.deal_status_notifications
  for select using (account_id in (select account_id from public.profiles where id = auth.uid()));
create policy "account members update own notices" on public.deal_status_notifications
  for update using (account_id in (select account_id from public.profiles where id = auth.uid()));

-- 2. Close every open todo for a contact x property pair, leaving an audit note.
create or replace function public.auto_close_todos(
  p_account_id uuid, p_contact_id uuid, p_property_id uuid, p_note text
) returns int language plpgsql security definer set search_path = public as $$
declare v_count int;
begin
  update todos
     set completed = true,
         description = concat_ws(E'\n', nullif(description,''), '[Auto-closed ' || to_char(now() at time zone 'Asia/Kolkata','DD Mon YYYY') || ': ' || p_note || ']')
   where account_id = p_account_id
     and not completed
     and (p_property_id is null or property_id = p_property_id)
     and (p_contact_id  is null or contact_id  = p_contact_id)
     and (p_property_id is not null or p_contact_id is not null);
  get diagnostics v_count = row_count;
  return v_count;
end $$;

-- 3. Queue a notice for one counterpart, skipping the property owner and phoneless contacts.
create or replace function public.queue_deal_status_notice(
  p_account_id uuid, p_contact_id uuid, p_name text, p_phone text, p_role text,
  p_property_id uuid, p_deal_id uuid, p_journey_item_id uuid, p_event text, p_reason text
) returns void language plpgsql security definer set search_path = public as $$
declare v_prop_title text; v_owner uuid; v_msg text;
begin
  select title, owner_contact_id into v_prop_title, v_owner from properties where id = p_property_id;
  if p_contact_id is not null and v_owner is not null and p_contact_id = v_owner then return; end if;
  if p_phone is null or p_phone = '' then return; end if;

  v_msg := case p_event
    when 'won' then format('Update on %s: the transaction has been concluded. Thank you for your trust in Aryavarta Ventures. We will stay in touch on the remaining formalities.', coalesce(v_prop_title,'the property'))
    when 'property_sold' then format('Update on %s: this property has been sold and is no longer available. We will share comparable options matching your requirement shortly.', coalesce(v_prop_title,'the property'))
    else format('Update on %s: this transaction will not be proceeding further. We will keep you posted on similar options that match your requirement.', coalesce(v_prop_title,'the property'))
  end;

  insert into deal_status_notifications
    (account_id, contact_id, recipient_name, recipient_phone, recipient_role, property_id, deal_id, journey_item_id, event, internal_reason, message_text)
  values (p_account_id, p_contact_id, p_name, p_phone, p_role, p_property_id, p_deal_id, p_journey_item_id, p_event, p_reason, v_msg)
  on conflict do nothing;
end $$;

-- 4. journey_items: a drop (deal lost also lands here via the existing deal->journey sync) closes the pair's todos and notifies the buyer contact.
create or replace function public.on_journey_item_dropped() returns trigger language plpgsql security definer set search_path = public as $$
declare c record; d record;
begin
  perform auto_close_todos(new.account_id, new.contact_id, new.property_id,
    'journey dropped' || coalesce(' — ' || new.drop_reason, ''));

  select id, name, phone into c from contacts where id = new.contact_id;
  select id, status into d from deals where contact_id = new.contact_id and property_id = new.property_id order by updated_at desc limit 1;

  perform queue_deal_status_notice(new.account_id, c.id, c.name, c.phone, 'buyer',
    new.property_id, d.id, new.id, case when d.status = 'lost' then 'lost' else 'dropped' end, new.drop_reason);

  -- other buyer-side stakeholders on the deal (advocate, banker, buyer-side broker)
  if d.id is not null then
    insert into deal_status_notifications
      (account_id, contact_id, recipient_name, recipient_phone, recipient_role, property_id, deal_id, journey_item_id, event, internal_reason, message_text)
    select s.account_id, s.contact_id, s.name, s.phone, s.role, new.property_id, d.id, new.id, 'lost', new.drop_reason,
           format('Update on %s: this transaction will not be proceeding further. Thank you for your support.', (select title from properties where id = new.property_id))
      from deal_stakeholders s
     where s.deal_id = d.id and s.side = 'buyer' and s.phone is not null
       and (s.contact_id is null or s.contact_id <> new.contact_id)
    on conflict do nothing;
  end if;
  return new;
end $$;

drop trigger if exists journey_item_dropped_sync_trigger on public.journey_items;
create trigger journey_item_dropped_sync_trigger
  after update of status on public.journey_items
  for each row when (new.status = 'dropped' and old.status is distinct from 'dropped')
  execute function public.on_journey_item_dropped();

-- 5. deals: won closes the pair's todos and notifies buyer side; lost is covered by (4) but handled here too in case no journey item exists.
create or replace function public.on_deal_closed() returns trigger language plpgsql security definer set search_path = public as $$
declare c record; v_event text;
begin
  v_event := new.status;  -- 'won' or 'lost'
  perform auto_close_todos(new.account_id, new.contact_id, new.property_id,
    'deal ' || v_event || coalesce(' — ' || new.lost_reason, ''));

  select id, name, phone into c from contacts where id = new.contact_id;
  perform queue_deal_status_notice(new.account_id, c.id, c.name, c.phone, 'buyer',
    new.property_id, new.id, new.source_journey_item_id, v_event, coalesce(new.lost_reason, new.lost_note));

  insert into deal_status_notifications
    (account_id, contact_id, recipient_name, recipient_phone, recipient_role, property_id, deal_id, event, internal_reason, message_text)
  select s.account_id, s.contact_id, s.name, s.phone, s.role, new.property_id, new.id, v_event, coalesce(new.lost_reason, new.lost_note),
         case when v_event = 'won'
              then format('Update on %s: the transaction has been concluded. Thank you for your support.', (select title from properties where id = new.property_id))
              else format('Update on %s: this transaction will not be proceeding further. Thank you for your support.', (select title from properties where id = new.property_id)) end
    from deal_stakeholders s
   where s.deal_id = new.id and s.side = 'buyer' and s.phone is not null
     and (s.contact_id is null or s.contact_id <> new.contact_id)
  on conflict do nothing;

  insert into deal_events (account_id, deal_id, event_type, source, title, metadata, visibility)
  values (new.account_id, new.id, 'tasks_auto_closed', 'system',
          'Follow-up tasks auto-closed; counterpart notices queued',
          jsonb_build_object('status', v_event, 'reason', coalesce(new.lost_reason, new.lost_note)), 'internal');
  return new;
end $$;

drop trigger if exists deal_closed_sync_trigger on public.deals;
create trigger deal_closed_sync_trigger
  after update of status on public.deals
  for each row when (new.status in ('won','lost') and old.status is distinct from new.status)
  execute function public.on_deal_closed();

-- 6. properties: Sold / Off Market / Archived closes every buyer's todos on that property; Sold also notifies active interested buyers.
create or replace function public.on_property_withdrawn() returns trigger language plpgsql security definer set search_path = public as $$
declare r record;
begin
  perform auto_close_todos(new.account_id, null, new.id, 'property marked ' || new.status);
  if new.status = 'Sold' then
    for r in select ji.id as ji_id, c.id, c.name, c.phone
               from journey_items ji join contacts c on c.id = ji.contact_id
              where ji.property_id = new.id and ji.status = 'active' and not ji.hidden
    loop
      perform queue_deal_status_notice(new.account_id, r.id, r.name, r.phone, 'buyer', new.id, null, r.ji_id, 'property_sold', null);
    end loop;
  end if;
  return new;
end $$;

drop trigger if exists property_withdrawn_sync_trigger on public.properties;
create trigger property_withdrawn_sync_trigger
  after update of status on public.properties
  for each row when (new.status in ('Sold','Off Market','Archived') and old.status is distinct from new.status)
  execute function public.on_property_withdrawn();
