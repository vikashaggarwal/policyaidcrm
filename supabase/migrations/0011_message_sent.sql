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
