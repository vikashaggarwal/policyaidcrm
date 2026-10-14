-- Dial Desk: the caller queue.
-- Ranking lives here, in one place, so paging stays correct for thousands of leads.
--   bucket 1  callback due now      (oldest callback first)
--   bucket 2  new                   (first loaded, first called)
--   bucket 3  no answer             (oldest attempt first)
--   bucket 4  later callbacks       (soonest first)
--   bucket 5  interested, nothing scheduled (worked; not in the to-do list)
--   bucket 6  sold / not interested (closed)
-- Do-not-call leads never appear: Row Level Security hides them from callers entirely.

create or replace function public.queue_bucket(
  p_status public.lead_status, p_callback_at timestamptz, p_now timestamptz default now()
) returns smallint
language sql immutable
as $$
  select (case
    when p_status in ('sold', 'not_interested', 'do_not_call') then 6
    when p_callback_at is not null and p_callback_at <= p_now then 1
    when p_status = 'new' then 2
    when p_status = 'no_answer' then 3
    when p_callback_at is not null then 4
    else 5
  end)::smallint
$$;

-- Search across name, city, registration number and (digits only) mobile number.
create or replace function public.lead_matches_search(
  p_search text, p_name text, p_city text, p_reg_no text, p_phone text
) returns boolean
language sql immutable
as $$
  with s as (
    select
      left(trim(coalesce(p_search, '')), 60) as raw
  ), p as (
    select
      raw,
      '%' || replace(replace(replace(raw, '\', '\\'), '%', '\%'), '_', '\_') || '%' as pattern,
      '%' || replace(replace(replace(upper(regexp_replace(raw, '[\s\-]', '', 'g')), '\', '\\'), '%', '\%'), '_', '\_') || '%' as reg_pattern,
      regexp_replace(raw, '\D', '', 'g') as digits
    from s
  )
  select raw = ''
      or p_name ilike pattern escape '\'
      or coalesce(p_city, '') ilike pattern escape '\'
      or p_reg_no ilike reg_pattern escape '\'
      or (length(digits) >= 3 and p_phone like '%' || digits || '%')
  from p
$$;

-- One page of the signed-in caller's queue. total_count is the size of the whole filtered list.
create or replace function public.my_queue(
  p_filter text default 'todo',
  p_search text default null,
  p_limit  integer default 30,
  p_offset integer default 0
) returns table (
  id uuid, name text, phone text, city text, reg_no text,
  vehicle_make text, vehicle_model text, status public.lead_status,
  callback_at timestamptz, attempts integer, last_called_at timestamptz,
  bucket smallint, total_count bigint
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
         m.callback_at, m.attempts, m.last_called_at, m.b, count(*) over () as total_count
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

create or replace function public.my_queue_counts(p_search text default null)
returns table (todo bigint, due bigint, new bigint, no_answer bigint, callbacks bigint, interested bigint, closed bigint)
language sql stable security invoker set search_path = public
as $$
  with mine as (
    select public.queue_bucket(l.status, l.callback_at) as b
    from public.leads l
    where l.assigned_to = auth.uid()
      and l.dnd = false
      and l.status <> 'do_not_call'
      and public.lead_matches_search(p_search, l.name, l.city, l.reg_no, l.phone)
  )
  select count(*) filter (where b in (1, 2, 3, 4)),
         count(*) filter (where b = 1),
         count(*) filter (where b = 2),
         count(*) filter (where b = 3),
         count(*) filter (where b = 4),
         count(*) filter (where b = 5),
         count(*) filter (where b = 6)
  from mine
$$;

-- Call history for a lead the caller owns (callers can't read other people's profiles directly).
create or replace function public.lead_history(p_lead_id uuid)
returns table (id uuid, outcome public.lead_status, note text, callback_at timestamptz,
               created_at timestamptz, caller_name text)
language sql stable security definer set search_path = public
as $$
  select c.id, c.outcome, c.note, c.callback_at, c.created_at, p.full_name
  from public.call_logs c
  join public.profiles p on p.id = c.caller_id
  where c.lead_id = p_lead_id
    and exists (
      select 1 from public.leads l
      where l.id = p_lead_id and (l.assigned_to = auth.uid() or public.is_staff())
    )
  order by c.created_at desc
  limit 100
$$;

-- Other vehicles registered to the same mobile number: minimal details, only for a lead you own.
create or replace function public.other_vehicles(p_lead_id uuid)
returns table (reg_no text, vehicle_make text, vehicle_model text, status public.lead_status)
language sql stable security definer set search_path = public
as $$
  select o.reg_no, o.vehicle_make, o.vehicle_model, o.status
  from public.leads me
  join public.leads o on o.phone = me.phone and o.id <> me.id
  where me.id = p_lead_id
    and (me.assigned_to = auth.uid() or public.is_staff())
  order by o.reg_no
  limit 20
$$;

revoke execute on function
  public.queue_bucket(public.lead_status, timestamptz, timestamptz),
  public.lead_matches_search(text, text, text, text, text),
  public.my_queue(text, text, integer, integer),
  public.my_queue_counts(text),
  public.lead_history(uuid),
  public.other_vehicles(uuid)
  from public, anon;
grant execute on function
  public.queue_bucket(public.lead_status, timestamptz, timestamptz),
  public.lead_matches_search(text, text, text, text, text),
  public.my_queue(text, text, integer, integer),
  public.my_queue_counts(text),
  public.lead_history(uuid),
  public.other_vehicles(uuid)
  to authenticated;
