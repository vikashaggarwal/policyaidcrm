-- PolicyAid CRM upgrade: Wrong number + Renewal date + caller editing + Message sent.
-- Paste into Supabase > SQL Editor > Run, ONCE, before the new version goes live. Safe on a database that has 0001-0008.

-- PolicyAid CRM: "Wrong number" outcome.
-- Like do-not-call, it removes the lead from the caller's queue for good, but it is NOT a legal
-- do-not-call flag (the person never asked to be left alone, the number just doesn't reach them).
-- Differences from do-not-call:
--   * it never sets the dnd flag, so the number can still be loaded or added later (e.g. once corrected)
--   * managers and admins can reopen it
--   * other not-yet-worked leads on the same number are marked too, so nobody rings it twice
-- New logic compares the status as text so this file can run in one go (Postgres will not let a
-- freshly added enum value be used by literal inside the same transaction).

alter type public.lead_status add value if not exists 'wrong_number';

-- Callers never see wrong-number leads, exactly like do-not-call leads.
drop policy if exists leads_select_caller on public.leads;
create policy leads_select_caller on public.leads for select to authenticated
  using (
    public.auth_role() = 'caller'
    and assigned_to = auth.uid()
    and dnd = false
    and status::text not in ('do_not_call', 'wrong_number')
  );

-- Closed statuses (never part of the to-do list).
create or replace function public.queue_bucket(
  p_status public.lead_status, p_callback_at timestamptz, p_now timestamptz default now()
) returns smallint
language sql immutable
as $$
  select (case
    when p_status::text in ('sold', 'not_interested', 'do_not_call', 'wrong_number') then 6
    when p_callback_at is not null and p_callback_at <= p_now then 1
    when p_status = 'new' then 2
    when p_status = 'no_answer' then 3
    when p_callback_at is not null then 4
    else 5
  end)::smallint
$$;

-- Same function as before, plus the wrong-number outcome.
create or replace function public.log_call(
  p_lead_id     uuid,
  p_outcome     public.lead_status,
  p_note        text default null,
  p_callback_at timestamptz default null
) returns public.leads
language plpgsql security definer set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_role  public.user_role := public.auth_role();
  v_lead  public.leads;
  v_note  text := nullif(trim(coalesce(p_note, '')), '');
  v_cb    timestamptz := p_callback_at;
begin
  if v_uid is null or v_role is null then
    raise exception 'not_allowed' using errcode = 'P0001';
  end if;

  select * into v_lead from public.leads where id = p_lead_id for update;
  if not found then
    raise exception 'lead_not_found' using errcode = 'P0001';
  end if;
  if v_role = 'caller' and v_lead.assigned_to is distinct from v_uid then
    raise exception 'not_allowed' using errcode = 'P0001';
  end if;
  if v_lead.dnd or v_lead.status = 'do_not_call' then
    raise exception 'lead_blocked' using errcode = 'P0001';
  end if;
  if v_lead.status::text = 'wrong_number' then
    raise exception 'lead_wrong_number' using errcode = 'P0001';
  end if;
  if p_outcome = 'new' then
    raise exception 'invalid_outcome' using errcode = 'P0001';
  end if;
  if v_note is not null and length(v_note) > 1000 then
    raise exception 'note_too_long' using errcode = 'P0001';
  end if;

  -- closed outcomes never carry a callback
  if p_outcome::text in ('sold', 'not_interested', 'do_not_call', 'wrong_number') then
    v_cb := null;
  elsif p_outcome = 'callback' and v_cb is null then
    raise exception 'callback_required' using errcode = 'P0001';
  end if;
  if v_cb is not null and v_cb < now() - interval '5 minutes' then
    raise exception 'callback_in_past' using errcode = 'P0001';
  end if;

  insert into public.call_logs (lead_id, caller_id, outcome, note, callback_at)
  values (v_lead.id, v_uid, p_outcome, v_note, v_cb);

  update public.leads
     set status         = p_outcome,
         attempts       = attempts + 1,
         last_called_at = now(),
         callback_at    = v_cb,
         dnd            = dnd or p_outcome = 'do_not_call'
   where id = v_lead.id
   returning * into v_lead;

  -- Do-not-call belongs to the person, not the vehicle: block every lead on that number.
  if p_outcome = 'do_not_call' then
    update public.leads
       set dnd = true, status = 'do_not_call', callback_at = null
     where phone = v_lead.phone and status <> 'do_not_call';
    perform public.write_audit('do_not_call', 'lead', v_lead.id::text,
                               jsonb_build_object('reg_no', v_lead.reg_no));
  end if;

  -- A wrong number is wrong for every vehicle on it: close the ones nobody has finished with.
  if p_outcome::text = 'wrong_number' then
    update public.leads
       set status = p_outcome, callback_at = null
     where phone = v_lead.phone and id <> v_lead.id
       and status::text in ('new', 'no_answer', 'callback');
    perform public.write_audit('wrong_number', 'lead', v_lead.id::text,
                               jsonb_build_object('reg_no', v_lead.reg_no));
  end if;

  return v_lead;
end $$;

-- A manager can put wrong-number leads back to "new" (mis-tap, or the number was corrected).
create or replace function public.reopen_leads(p_lead_ids uuid[])
returns integer
language plpgsql security definer set search_path = public
as $$
declare v_count integer;
begin
  if not public.is_staff() then
    raise exception 'not_allowed' using errcode = 'P0001';
  end if;
  if p_lead_ids is null or cardinality(p_lead_ids) = 0 or cardinality(p_lead_ids) > 5000 then
    raise exception 'invalid_selection' using errcode = 'P0001';
  end if;

  update public.leads
     set status = 'new', callback_at = null
   where id = any (p_lead_ids) and status::text = 'wrong_number';
  get diagnostics v_count = row_count;

  perform public.write_audit('reopen_leads', 'lead', null,
    jsonb_build_object('count', v_count, 'sample_ids', to_jsonb(p_lead_ids[1:20])));
  return v_count;
end $$;

revoke execute on function public.reopen_leads(uuid[]) from public, anon;
grant execute on function public.reopen_leads(uuid[]) to authenticated;

-- PolicyAid CRM: editable Renewal date, caller edits, and the renewal date in the lists.
--
-- "Renewal date" replaces the calculated "policy expiry". It still DEFAULTS to registration date + 5 days
-- (the agreed rule) but is a real column now, so a caller can correct it ("my policy renews on 3 March") and
-- an upload can supply it. Existing values are carried over unchanged.
-- Safe to run once, on a database that already has migrations 0001-0009.

alter table public.leads add column if not exists renewal_date date;
update public.leads set renewal_date = policy_expiry where renewal_date is null;

drop index if exists public.leads_policy_expiry_idx;
alter table public.leads drop column if exists policy_expiry;
create index if not exists leads_renewal_date_idx on public.leads (renewal_date);

-- Default rule: registration date + 5 days, unless a renewal date was given or has been edited.
create or replace function public.set_renewal_date()
returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    if new.renewal_date is null and new.reg_date is not null then
      new.renewal_date := new.reg_date + 5;
    end if;
  elsif new.reg_date is distinct from old.reg_date
        and new.reg_date is not null
        and new.renewal_date is not distinct from old.renewal_date
        and coalesce(current_setting('app.renewal_explicit', true), '') <> '1' then
    -- the registration date was corrected and nobody set the renewal date by hand: keep the rule
    new.renewal_date := new.reg_date + 5;
  end if;
  return new;
end $$;

drop trigger if exists leads_set_renewal on public.leads;
create trigger leads_set_renewal before insert or update on public.leads
  for each row execute function public.set_renewal_date();
revoke execute on function public.set_renewal_date() from public, anon, authenticated;

-- The lists now carry the renewal date. (A function's output columns can't be changed in place.)
drop function if exists public.my_queue(text, text, integer, integer);
create function public.my_queue(
  p_filter text default 'todo',
  p_search text default null,
  p_limit  integer default 30,
  p_offset integer default 0
) returns table (
  id uuid, name text, phone text, city text, reg_no text,
  vehicle_make text, vehicle_model text, status public.lead_status,
  callback_at timestamptz, attempts integer, last_called_at timestamptz,
  renewal_date date, bucket smallint, total_count bigint
)
language sql stable security invoker set search_path = public
as $$
  with mine as (
    select l.*, public.queue_bucket(l.status, l.callback_at) as b
    from public.leads l
    where l.assigned_to = auth.uid()
      and l.dnd = false
      and l.status <> 'do_not_call'
      and public.lead_matches_search(p_search, l.name, l.city, l.reg_no, l.phone)
  )
  select m.id, m.name, m.phone, m.city, m.reg_no, m.vehicle_make, m.vehicle_model, m.status,
         m.callback_at, m.attempts, m.last_called_at, m.renewal_date, m.b, count(*) over () as total_count
  from mine m
  where case p_filter
    when 'todo'      then m.b in (1, 2, 3, 4)
    when 'due'       then m.b = 1
    when 'new'       then m.b = 2
    when 'no_answer' then m.b = 3
    when 'callbacks' then m.b = 4
    when 'interested' then m.b = 5
    when 'closed'    then m.b = 6
    else false
  end
  order by m.b,
           case when m.b in (1, 4) then m.callback_at end asc,
           case when m.b = 3 then m.last_called_at end asc nulls first,
           case when m.b in (5, 6) then m.last_called_at end desc nulls last,
           m.created_at asc, m.id asc
  limit least(greatest(coalesce(p_limit, 30), 1), 100)
  offset greatest(coalesce(p_offset, 0), 0)
$$;
revoke execute on function public.my_queue(text, text, integer, integer) from public, anon;
grant execute on function public.my_queue(text, text, integer, integer) to authenticated;

drop function if exists public.staff_leads(text, text, text, uuid, integer, integer);
create function public.staff_leads(
  p_assigned text default 'any',      -- 'any' | 'unassigned' | a caller's id
  p_status   text default 'any',      -- 'any' | a lead_status
  p_search   text default null,
  p_batch    uuid default null,
  p_limit    integer default 50,
  p_offset   integer default 0
) returns table (
  id uuid, name text, phone text, reg_no text, vehicle_make text, vehicle_model text,
  status public.lead_status, assigned_to uuid, assigned_name text, callback_at timestamptz,
  attempts integer, dnd boolean, created_at timestamptz, renewal_date date, total_count bigint
)
language plpgsql stable security invoker set search_path = public
as $$
begin
  if not public.is_staff() then
    raise exception 'not_allowed' using errcode = 'P0001';
  end if;
  return query
    select l.id, l.name, l.phone, l.reg_no, l.vehicle_make, l.vehicle_model, l.status,
           l.assigned_to, p.full_name, l.callback_at, l.attempts, l.dnd, l.created_at, l.renewal_date,
           count(*) over () as total_count
    from public.leads l
    left join public.profiles p on p.id = l.assigned_to
    where (p_assigned = 'any'
           or (p_assigned = 'unassigned' and l.assigned_to is null)
           or l.assigned_to::text = p_assigned)
      and (p_status = 'any' or l.status::text = p_status)
      and (p_batch is null or l.batch_id = p_batch)
      and public.lead_matches_search(p_search, l.name, l.city, l.reg_no, l.phone)
    order by l.created_at desc, l.id
    limit least(greatest(coalesce(p_limit, 50), 1), 1000)
    offset greatest(coalesce(p_offset, 0), 0);
end $$;

revoke execute on function public.staff_leads(text, text, text, uuid, integer, integer) from public, anon;
grant execute on function public.staff_leads(text, text, text, uuid, integer, integer) to authenticated;

-- Callers can add a lead with an optional renewal date.
create or replace function public.add_lead(p_lead jsonb)
returns public.leads
language plpgsql security definer set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_name  text := nullif(regexp_replace(trim(coalesce(p_lead ->> 'name', '')), '\s+', ' ', 'g'), '');
  v_phone text := regexp_replace(coalesce(p_lead ->> 'phone', ''), '\D', '', 'g');
  v_reg   text := nullif(upper(regexp_replace(coalesce(p_lead ->> 'reg_no', ''), '[\s\-._]', '', 'g')), '');
  v_date  date;
  v_renew date;
  v_sale  numeric;
  v_seats integer;
  v_lead  public.leads;
  t       text;
begin
  if v_uid is null or public.auth_role() is distinct from 'caller' then
    raise exception 'not_allowed' using errcode = 'P0001';
  end if;

  if v_name is null or length(v_name) > 120 then
    raise exception 'name_required' using errcode = 'P0001';
  end if;
  -- same clean-up as the app: +91 / 91 / 0091 / leading 0
  if length(v_phone) = 14 and left(v_phone, 4) = '0091' then v_phone := substr(v_phone, 5);
  elsif length(v_phone) = 12 and left(v_phone, 2) = '91' then v_phone := substr(v_phone, 3);
  elsif length(v_phone) = 11 and left(v_phone, 1) = '0' then v_phone := substr(v_phone, 2);
  end if;
  if v_phone !~ '^[6-9][0-9]{9}$' then
    raise exception 'invalid_phone' using errcode = 'P0001';
  end if;
  if v_reg is not null and v_reg !~ '^[A-Z0-9]{4,15}$' then
    raise exception 'invalid_reg_no' using errcode = 'P0001';
  end if;

  t := nullif(trim(coalesce(p_lead ->> 'reg_date', '')), '');
  if t is not null then
    begin
      v_date := t::date;
    exception when others then
      raise exception 'invalid_date' using errcode = 'P0001';
    end;
    if v_date < date '1980-01-01' or v_date > date '2100-12-31' then
      raise exception 'invalid_date' using errcode = 'P0001';
    end if;
  end if;

  t := nullif(trim(coalesce(p_lead ->> 'renewal_date', '')), '');
  if t is not null then
    begin
      v_renew := t::date;
    exception when others then
      raise exception 'invalid_date' using errcode = 'P0001';
    end;
    if v_renew < date '1980-01-01' or v_renew > date '2100-12-31' then
      raise exception 'invalid_date' using errcode = 'P0001';
    end if;
  end if;

  t := nullif(trim(coalesce(p_lead ->> 'sale_amount', '')), '');
  if t is not null and t ~ '^[0-9]{1,12}(\.[0-9]{1,2})?$' then v_sale := t::numeric; end if;
  t := nullif(trim(coalesce(p_lead ->> 'seat_capacity', '')), '');
  if t is not null and t ~ '^[0-9]{1,3}$' and t::integer <= 200 then v_seats := t::integer; end if;

  -- Never add a number that has asked not to be called, whichever vehicle it was on.
  if exists (select 1 from public.leads where phone = v_phone and (dnd or status = 'do_not_call')) then
    raise exception 'lead_blocked' using errcode = 'P0001';
  end if;
  if v_reg is not null then
    if exists (select 1 from public.leads where reg_no = v_reg) then
      raise exception 'duplicate_vehicle' using errcode = 'P0001';
    end if;
  elsif exists (select 1 from public.leads where phone = v_phone) then
    raise exception 'duplicate_phone' using errcode = 'P0001';
  end if;

  insert into public.leads (
    name, phone, reg_no, reg_date, renewal_date, guardian_name, state, rto_code, address, city,
    engine_no, chassis_no, vehicle_make, vehicle_model, vehicle_class, fuel, sale_amount, seat_capacity,
    source, assigned_to
  ) values (
    v_name, v_phone, v_reg, v_date, v_renew,
    left(nullif(trim(p_lead ->> 'guardian_name'), ''), 120),
    left(nullif(trim(p_lead ->> 'state'), ''), 60),
    upper(left(nullif(trim(p_lead ->> 'rto_code'), ''), 20)),
    left(nullif(trim(p_lead ->> 'address'), ''), 500),
    left(nullif(trim(p_lead ->> 'city'), ''), 80),
    upper(left(nullif(trim(p_lead ->> 'engine_no'), ''), 40)),
    upper(left(nullif(trim(p_lead ->> 'chassis_no'), ''), 40)),
    left(nullif(trim(p_lead ->> 'vehicle_make'), ''), 80),
    left(nullif(trim(p_lead ->> 'vehicle_model'), ''), 120),
    left(nullif(trim(p_lead ->> 'vehicle_class'), ''), 60),
    left(nullif(trim(p_lead ->> 'fuel'), ''), 30),
    v_sale, v_seats,
    'Added by caller', v_uid
  ) returning * into v_lead;

  perform public.write_audit('add_lead', 'lead', v_lead.id::text, jsonb_build_object('reg_no', v_lead.reg_no));
  return v_lead;
end $$;

-- ------------------------------------------------------------- caller edits
-- The owner of a lead (or staff) can correct any of its details. Status, attempts, assignment and the
-- do-not-call flag are NOT editable here. Everything is re-validated, a number on the do-not-call list
-- can't be switched in, and every change is recorded (who, which fields, before and after).
create or replace function public.update_lead(p_lead_id uuid, p_patch jsonb)
returns public.leads
language plpgsql security definer set search_path = public
as $$
declare
  v_uid     uuid := auth.uid();
  v_role    public.user_role := public.auth_role();
  v_old     public.leads;
  v_new     public.leads;
  t         text;
  v_phone   text;
  v_reg     text;
  v_date    date;
  k         text;
  v_changes jsonb;
begin
  if v_uid is null or v_role is null then
    raise exception 'not_allowed' using errcode = 'P0001';
  end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then
    raise exception 'invalid_lead' using errcode = 'P0001';
  end if;

  select * into v_old from public.leads where id = p_lead_id for update;
  if not found then
    raise exception 'lead_not_found' using errcode = 'P0001';
  end if;
  if v_role = 'caller' and v_old.assigned_to is distinct from v_uid then
    raise exception 'not_allowed' using errcode = 'P0001';
  end if;
  if v_old.dnd or v_old.status = 'do_not_call' then
    raise exception 'lead_blocked' using errcode = 'P0001';
  end if;
  if v_old.status::text = 'wrong_number' and v_role = 'caller' then
    raise exception 'lead_wrong_number' using errcode = 'P0001';
  end if;

  v_new := v_old;

  if p_patch ? 'name' then
    t := nullif(regexp_replace(trim(coalesce(p_patch ->> 'name', '')), '\s+', ' ', 'g'), '');
    if t is null or length(t) > 120 then
      raise exception 'name_required' using errcode = 'P0001';
    end if;
    v_new.name := t;
  end if;

  if p_patch ? 'phone' then
    v_phone := regexp_replace(coalesce(p_patch ->> 'phone', ''), '\D', '', 'g');
    if length(v_phone) = 14 and left(v_phone, 4) = '0091' then v_phone := substr(v_phone, 5);
    elsif length(v_phone) = 12 and left(v_phone, 2) = '91' then v_phone := substr(v_phone, 3);
    elsif length(v_phone) = 11 and left(v_phone, 1) = '0' then v_phone := substr(v_phone, 2);
    end if;
    if v_phone !~ '^[6-9][0-9]{9}$' then
      raise exception 'invalid_phone' using errcode = 'P0001';
    end if;
    -- switching a lead onto a number that asked not to be called would be a way round the list
    if v_phone is distinct from v_old.phone
       and exists (select 1 from public.leads where phone = v_phone and (dnd or status = 'do_not_call')) then
      raise exception 'lead_blocked' using errcode = 'P0001';
    end if;
    v_new.phone := v_phone;
  end if;

  if p_patch ? 'reg_no' then
    v_reg := nullif(upper(regexp_replace(coalesce(p_patch ->> 'reg_no', ''), '[\s\-._]', '', 'g')), '');
    if v_reg is not null and v_reg !~ '^[A-Z0-9]{4,15}$' then
      raise exception 'invalid_reg_no' using errcode = 'P0001';
    end if;
    if v_reg is not null and v_reg is distinct from v_old.reg_no
       and exists (select 1 from public.leads where reg_no = v_reg and id <> p_lead_id) then
      raise exception 'duplicate_vehicle' using errcode = 'P0001';
    end if;
    v_new.reg_no := v_reg;
  end if;

  foreach k in array array['reg_date', 'renewal_date'] loop
    if p_patch ? k then
      t := nullif(trim(coalesce(p_patch ->> k, '')), '');
      v_date := null;
      if t is not null then
        begin
          v_date := t::date;
        exception when others then
          raise exception 'invalid_date' using errcode = 'P0001';
        end;
        if v_date < date '1980-01-01' or v_date > date '2100-12-31' then
          raise exception 'invalid_date' using errcode = 'P0001';
        end if;
      end if;
      if k = 'reg_date' then v_new.reg_date := v_date; else v_new.renewal_date := v_date; end if;
    end if;
  end loop;

  if p_patch ? 'guardian_name' then v_new.guardian_name := left(nullif(trim(coalesce(p_patch ->> 'guardian_name', '')), ''), 120); end if;
  if p_patch ? 'state'         then v_new.state         := left(nullif(trim(coalesce(p_patch ->> 'state', '')), ''), 60); end if;
  if p_patch ? 'rto_code'      then v_new.rto_code      := upper(left(nullif(trim(coalesce(p_patch ->> 'rto_code', '')), ''), 20)); end if;
  if p_patch ? 'address'       then v_new.address       := left(nullif(trim(coalesce(p_patch ->> 'address', '')), ''), 500); end if;
  if p_patch ? 'city'          then v_new.city          := left(nullif(trim(coalesce(p_patch ->> 'city', '')), ''), 80); end if;
  if p_patch ? 'engine_no'     then v_new.engine_no     := upper(left(nullif(trim(coalesce(p_patch ->> 'engine_no', '')), ''), 40)); end if;
  if p_patch ? 'chassis_no'    then v_new.chassis_no    := upper(left(nullif(trim(coalesce(p_patch ->> 'chassis_no', '')), ''), 40)); end if;
  if p_patch ? 'vehicle_make'  then v_new.vehicle_make  := left(nullif(trim(coalesce(p_patch ->> 'vehicle_make', '')), ''), 80); end if;
  if p_patch ? 'vehicle_model' then v_new.vehicle_model := left(nullif(trim(coalesce(p_patch ->> 'vehicle_model', '')), ''), 120); end if;
  if p_patch ? 'vehicle_class' then v_new.vehicle_class := left(nullif(trim(coalesce(p_patch ->> 'vehicle_class', '')), ''), 60); end if;
  if p_patch ? 'fuel'          then v_new.fuel          := left(nullif(trim(coalesce(p_patch ->> 'fuel', '')), ''), 30); end if;

  if p_patch ? 'sale_amount' then
    t := nullif(trim(coalesce(p_patch ->> 'sale_amount', '')), '');
    if t is null then
      v_new.sale_amount := null;
    elsif t ~ '^[0-9]{1,12}(\.[0-9]{1,2})?$' then
      v_new.sale_amount := t::numeric;
    else
      raise exception 'invalid_number' using errcode = 'P0001';
    end if;
  end if;
  if p_patch ? 'seat_capacity' then
    t := nullif(trim(coalesce(p_patch ->> 'seat_capacity', '')), '');
    if t is null then
      v_new.seat_capacity := null;
    elsif t ~ '^[0-9]{1,3}$' and t::integer <= 200 then
      v_new.seat_capacity := t::integer;
    else
      raise exception 'invalid_number' using errcode = 'P0001';
    end if;
  end if;

  -- What actually changed? (Everything not edited above is an unchanged copy of the old row.)
  select jsonb_object_agg(key, jsonb_build_object('from', to_jsonb(v_old) -> key, 'to', to_jsonb(v_new) -> key))
    into v_changes
    from jsonb_object_keys(to_jsonb(v_new)) as key
   where to_jsonb(v_old) -> key is distinct from to_jsonb(v_new) -> key;

  if v_changes is null then
    return v_old; -- nothing to save, nothing to record
  end if;

  -- if the edit names a renewal date, it wins over the registration-date rule
  perform set_config('app.renewal_explicit', case when p_patch ? 'renewal_date' then '1' else '' end, true);
  update public.leads set
    name = v_new.name, phone = v_new.phone, reg_no = v_new.reg_no, reg_date = v_new.reg_date,
    renewal_date = v_new.renewal_date, guardian_name = v_new.guardian_name, state = v_new.state,
    rto_code = v_new.rto_code, address = v_new.address, city = v_new.city, engine_no = v_new.engine_no,
    chassis_no = v_new.chassis_no, vehicle_make = v_new.vehicle_make, vehicle_model = v_new.vehicle_model,
    vehicle_class = v_new.vehicle_class, fuel = v_new.fuel, sale_amount = v_new.sale_amount,
    seat_capacity = v_new.seat_capacity
  where id = p_lead_id
  returning * into v_new;

  perform public.write_audit('edit_lead', 'lead', p_lead_id::text,
    jsonb_build_object('reg_no', v_new.reg_no, 'changes', v_changes));
  return v_new;
end $$;

revoke execute on function public.update_lead(uuid, jsonb) from public, anon;
grant execute on function public.update_lead(uuid, jsonb) to authenticated;

-- PolicyAid CRM: "Message sent" outcome (WhatsApp / SMS / email sent instead of, or after, a call).
-- The lead stays in the caller's queue for another try (like "No answer"), with an optional callback time.
-- Safe to run once, on a database that already has migrations 0001-0010.

alter type public.lead_status add value if not exists 'message_sent';

-- A freshly added enum value can't be used as a literal in the same transaction, so compare as text.
create or replace function public.queue_bucket(
  p_status public.lead_status, p_callback_at timestamptz, p_now timestamptz default now()
) returns smallint
language sql immutable
as $$
  select (case
    when p_status::text in ('sold', 'not_interested', 'do_not_call', 'wrong_number') then 6
    when p_callback_at is not null and p_callback_at <= p_now then 1
    when p_status = 'new' then 2
    when p_status::text in ('no_answer', 'message_sent') then 3
    when p_callback_at is not null then 4
    else 5
  end)::smallint
$$;

-- Same as before; a wrong number now also closes untouched "message sent" leads on that number.
create or replace function public.log_call(
  p_lead_id     uuid,
  p_outcome     public.lead_status,
  p_note        text default null,
  p_callback_at timestamptz default null
) returns public.leads
language plpgsql security definer set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_role  public.user_role := public.auth_role();
  v_lead  public.leads;
  v_note  text := nullif(trim(coalesce(p_note, '')), '');
  v_cb    timestamptz := p_callback_at;
begin
  if v_uid is null or v_role is null then
    raise exception 'not_allowed' using errcode = 'P0001';
  end if;

  select * into v_lead from public.leads where id = p_lead_id for update;
  if not found then
    raise exception 'lead_not_found' using errcode = 'P0001';
  end if;
  if v_role = 'caller' and v_lead.assigned_to is distinct from v_uid then
    raise exception 'not_allowed' using errcode = 'P0001';
  end if;
  if v_lead.dnd or v_lead.status = 'do_not_call' then
    raise exception 'lead_blocked' using errcode = 'P0001';
  end if;
  if v_lead.status::text = 'wrong_number' then
    raise exception 'lead_wrong_number' using errcode = 'P0001';
  end if;
  if p_outcome = 'new' then
    raise exception 'invalid_outcome' using errcode = 'P0001';
  end if;
  if v_note is not null and length(v_note) > 1000 then
    raise exception 'note_too_long' using errcode = 'P0001';
  end if;

  -- closed outcomes never carry a callback
  if p_outcome::text in ('sold', 'not_interested', 'do_not_call', 'wrong_number') then
    v_cb := null;
  elsif p_outcome = 'callback' and v_cb is null then
    raise exception 'callback_required' using errcode = 'P0001';
  end if;
  if v_cb is not null and v_cb < now() - interval '5 minutes' then
    raise exception 'callback_in_past' using errcode = 'P0001';
  end if;

  insert into public.call_logs (lead_id, caller_id, outcome, note, callback_at)
  values (v_lead.id, v_uid, p_outcome, v_note, v_cb);

  update public.leads
     set status         = p_outcome,
         attempts       = attempts + 1,
         last_called_at = now(),
         callback_at    = v_cb,
         dnd            = dnd or p_outcome = 'do_not_call'
   where id = v_lead.id
   returning * into v_lead;

  -- Do-not-call belongs to the person, not the vehicle: block every lead on that number.
  if p_outcome = 'do_not_call' then
    update public.leads
       set dnd = true, status = 'do_not_call', callback_at = null
     where phone = v_lead.phone and status <> 'do_not_call';
    perform public.write_audit('do_not_call', 'lead', v_lead.id::text,
                               jsonb_build_object('reg_no', v_lead.reg_no));
  end if;

  -- A wrong number is wrong for every vehicle on it: close the ones nobody has finished with.
  if p_outcome::text = 'wrong_number' then
    update public.leads
       set status = p_outcome, callback_at = null
     where phone = v_lead.phone and id <> v_lead.id
       and status::text in ('new', 'no_answer', 'callback', 'message_sent');
    perform public.write_audit('wrong_number', 'lead', v_lead.id::text,
                               jsonb_build_object('reg_no', v_lead.reg_no));
  end if;

  return v_lead;
end $$;


-- A sent message is not a conversation: it doesn't count as a connected call on the dashboard.
create or replace function public.dashboard_summary(p_from timestamptz, p_to timestamptz)
returns jsonb
language plpgsql stable security invoker set search_path = public
as $$
declare
  v_result jsonb;
begin
  if not public.is_staff() then
    raise exception 'not_allowed' using errcode = 'P0001';
  end if;

  with cohort as (
    select l.status, l.attempts
    from public.leads l
    where (p_from is null or l.created_at >= p_from) and (p_to is null or l.created_at < p_to)
  ),
  by_status as (
    select coalesce(jsonb_object_agg(status, n), '{}'::jsonb) as j
    from (select status, count(*) as n from cohort group by status) s
  ),
  live as (
    select
      count(*) filter (where callback_at <= now() and dnd = false
                         and status not in ('sold', 'not_interested', 'do_not_call')) as due_now,
      count(*) filter (where assigned_to is null and dnd = false and status = 'new') as unassigned_new
    from public.leads
  ),
  act as (
    select c.caller_id,
           count(*) as calls,
           count(distinct c.lead_id) as called,
           count(distinct c.lead_id) filter (where c.outcome::text not in ('no_answer', 'message_sent')) as connected,
           count(distinct c.lead_id) filter (where c.outcome = 'interested') as interested,
           count(distinct c.lead_id) filter (where c.outcome = 'sold') as sold
    from public.call_logs c
    where (p_from is null or c.created_at >= p_from) and (p_to is null or c.created_at < p_to)
    group by c.caller_id
  ),
  asg as (
    select assigned_to as id,
           count(*) as assigned,
           count(*) filter (where callback_at < now() and dnd = false
                              and status not in ('sold', 'not_interested', 'do_not_call')) as overdue,
           count(*) filter (where status = 'new' and attempts = 0 and dnd = false) as unworked
    from public.leads
    where assigned_to is not null
    group by assigned_to
  ),
  callers as (
    select coalesce(jsonb_agg(jsonb_build_object(
             'id', p.id, 'name', p.full_name, 'login_id', p.login_id, 'active', p.active,
             'assigned', coalesce(asg.assigned, 0), 'unworked', coalesce(asg.unworked, 0),
             'overdue', coalesce(asg.overdue, 0),
             'calls', coalesce(act.calls, 0), 'called', coalesce(act.called, 0),
             'connected', coalesce(act.connected, 0), 'interested', coalesce(act.interested, 0),
             'sold', coalesce(act.sold, 0)
           ) order by p.full_name), '[]'::jsonb) as j
    from public.profiles p
    left join act on act.caller_id = p.id
    left join asg on asg.id = p.id
    where p.role = 'caller' and (p.active or act.caller_id is not null or asg.id is not null)
  )
  select jsonb_build_object(
    'loaded',          (select count(*) from cohort),
    'called_once',     (select count(*) from cohort where attempts > 0),
    'sold',            (select count(*) from cohort where status = 'sold'),
    'by_status',       (select j from by_status),
    'callbacks_due',   (select due_now from live),
    'unassigned_new',  (select unassigned_new from live),
    'calls',           (select coalesce(sum(calls), 0) from act),
    'callers',         (select j from callers)
  ) into v_result;

  return v_result;
end $$;

-- ------------------------------------------------------------- leads list (manager view)
