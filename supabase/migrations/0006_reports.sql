-- Dial Desk: manager reporting, the leads list with filters, and export auditing.
-- All of these refuse to run for callers (RLS would also limit them to their own rows).

-- ------------------------------------------------------------- dashboard
-- Two scopes, stated on screen:
--   pipeline  = leads LOADED in [p_from, p_to)   (null bounds = all time)
--   callers   = calls MADE in [p_from, p_to)
--   live      = callbacks due / overdue / unassigned right now, never date-filtered
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
           count(distinct c.lead_id) filter (where c.outcome <> 'no_answer') as connected,
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
create or replace function public.staff_leads(
  p_assigned text default 'any',      -- 'any' | 'unassigned' | a caller's id
  p_status   text default 'any',      -- 'any' | a lead_status
  p_search   text default null,
  p_batch    uuid default null,
  p_limit    integer default 50,
  p_offset   integer default 0
) returns table (
  id uuid, name text, phone text, reg_no text, vehicle_make text, vehicle_model text,
  status public.lead_status, assigned_to uuid, assigned_name text, callback_at timestamptz,
  attempts integer, dnd boolean, created_at timestamptz, total_count bigint
)
language plpgsql stable security invoker set search_path = public
as $$
begin
  if not public.is_staff() then
    raise exception 'not_allowed' using errcode = 'P0001';
  end if;
  return query
    select l.id, l.name, l.phone, l.reg_no, l.vehicle_make, l.vehicle_model, l.status,
           l.assigned_to, p.full_name, l.callback_at, l.attempts, l.dnd, l.created_at,
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

-- Same filters, ids only: powers "select all N matching" for bulk actions (capped at 5,000).
create or replace function public.staff_lead_ids(
  p_assigned text default 'any', p_status text default 'any', p_search text default null, p_batch uuid default null
) returns setof uuid
language plpgsql stable security invoker set search_path = public
as $$
begin
  if not public.is_staff() then
    raise exception 'not_allowed' using errcode = 'P0001';
  end if;
  return query
    select l.id
    from public.leads l
    where (p_assigned = 'any'
           or (p_assigned = 'unassigned' and l.assigned_to is null)
           or l.assigned_to::text = p_assigned)
      and (p_status = 'any' or l.status::text = p_status)
      and (p_batch is null or l.batch_id = p_batch)
      and public.lead_matches_search(p_search, l.name, l.city, l.reg_no, l.phone)
    order by l.created_at desc, l.id
    limit 5000;
end $$;

-- How many never-called leads would "reassign all unworked from X" move?
create or replace function public.unworked_count(p_caller uuid)
returns bigint
language plpgsql stable security invoker set search_path = public
as $$
begin
  if not public.is_staff() then
    raise exception 'not_allowed' using errcode = 'P0001';
  end if;
  return (select count(*) from public.leads
          where assigned_to = p_caller and status = 'new' and attempts = 0 and dnd = false);
end $$;

-- ------------------------------------------------------------- export audit
create or replace function public.log_export(p_kind text, p_format text, p_rows integer, p_filters jsonb)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_staff() then
    raise exception 'not_allowed' using errcode = 'P0001';
  end if;
  if p_kind not in ('leads', 'call_logs') or p_format not in ('csv', 'xlsx') then
    raise exception 'invalid_export' using errcode = 'P0001';
  end if;
  perform public.write_audit('export', 'export', p_kind,
    jsonb_build_object('format', p_format, 'rows', greatest(coalesce(p_rows, 0), 0),
                       'filters', coalesce(p_filters, '{}'::jsonb)));
end $$;

revoke execute on function
  public.dashboard_summary(timestamptz, timestamptz),
  public.staff_leads(text, text, text, uuid, integer, integer),
  public.staff_lead_ids(text, text, text, uuid),
  public.unworked_count(uuid),
  public.log_export(text, text, integer, jsonb)
  from public, anon;
grant execute on function
  public.dashboard_summary(timestamptz, timestamptz),
  public.staff_leads(text, text, text, uuid, integer, integer),
  public.staff_lead_ids(text, text, text, uuid),
  public.unworked_count(uuid),
  public.log_export(text, text, integer, jsonb)
  to authenticated;

-- ------------------------------------------------------------- export source
-- Full lead rows with the same filters as the list, in stable pages (PostgREST caps a response at 1,000 rows).
create or replace function public.export_leads(
  p_assigned text default 'any', p_status text default 'any', p_search text default null, p_batch uuid default null,
  p_limit integer default 1000, p_offset integer default 0
) returns setof public.leads
language plpgsql stable security invoker set search_path = public
as $$
begin
  if not public.is_staff() then
    raise exception 'not_allowed' using errcode = 'P0001';
  end if;
  return query
    select l.*
    from public.leads l
    where (p_assigned = 'any'
           or (p_assigned = 'unassigned' and l.assigned_to is null)
           or l.assigned_to::text = p_assigned)
      and (p_status = 'any' or l.status::text = p_status)
      and (p_batch is null or l.batch_id = p_batch)
      and public.lead_matches_search(p_search, l.name, l.city, l.reg_no, l.phone)
    order by l.created_at, l.id
    limit least(greatest(coalesce(p_limit, 1000), 1), 1000)
    offset greatest(coalesce(p_offset, 0), 0);
end $$;

revoke execute on function public.export_leads(text, text, text, uuid, integer, integer) from public, anon;
grant execute on function public.export_leads(text, text, text, uuid, integer, integer) to authenticated;
